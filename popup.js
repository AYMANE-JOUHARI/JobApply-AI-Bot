/* popup.js — JobApply AI Bot (ES‑module, OpenAI‑key centralized)
 * Updated 2025‑05‑07 — buttons keep a visible label when disabled
 * ---------------------------------------------------------------- */

/* ───────── Imports ───────── */
import { React, ReactDOM } from './scripts/init-react.js';
import * as pdfjsLib       from './scripts/pdf.mjs';
import { getOpenAIKey }    from './utils/api.js';

const { useState, useEffect, useCallback, useRef, useMemo } = React;

/* PDF‑JS worker (must be set before getDocument()) */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  chrome.runtime.getURL('scripts/pdf.worker.mjs');

/* ───────── Utility helpers ───────── */
const wait        = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, msg = 'Timeout') =>
  Promise.race([ p, wait(ms).then(() => { throw new Error(msg); }) ]);

/**
 * Send a message to the active tab.
 * If the content‑script isn’t present, inject it once then retry.
 *
 * @param {number} tabId
 * @param {object} payload
 * @param {object} [opts]       { timeoutMs?: number }
 * @param {number} [retries]
 */
const sendToTab = async (tabId, payload, opts = {}, retries = 1) => {
  const { timeoutMs = 10_000 } = opts; // default 10 s
  try {
    return await withTimeout(
      new Promise((res, rej) => {
        chrome.tabs.sendMessage(tabId, payload, resp => {
          if (chrome.runtime.lastError)
            return rej(new Error(chrome.runtime.lastError.message));
          res(resp);
        });
      }),
      timeoutMs
    );
  } catch (err) {
    if (retries > 0 && /Receiving end does not exist/i.test(err.message)) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await wait(400); // give it time to register listeners
      return sendToTab(tabId, payload, opts, retries - 1);
    }
    throw err;
  }
};

/* ───────── Error Boundary ───────── */
class ErrorBoundary extends React.Component {
  state = { hasError: false, info: null };
  static getDerivedStateFromError () { return { hasError: true }; }
  componentDidCatch (err, info) {
    console.error(err, info);
    chrome.runtime.sendMessage({
      type : 'ERROR_REPORT',
      error: err.toString(),
      stack: info.componentStack
    });
    this.setState({ info });
  }
  render () {
    if (!this.state.hasError) return this.props.children;
    return React.createElement('div', { className: 'p-4 bg-red-50 border border-red-200 rounded m-2' }, [
      React.createElement('h3', { className: 'text-red-600 font-semibold' }, 'Critical Error'),
      React.createElement('pre', { className: 'text-xs text-red-500 whitespace-pre-wrap' }, this.state.info?.componentStack),
      React.createElement('button', {
        className: 'mt-3 px-3 py-1 bg-red-100 hover:bg-red-200 rounded',
        onClick: () => location.reload()
      }, 'Reload')
    ]);
  }
}

/* ───────── Button helper ───────── */
const Button = ({ onClick, disabled, className = '', children }) =>
  React.createElement('button',
    {
      onClick,
      disabled,
      className:
        [
          // size / layout
          'w-full px-4 py-2 rounded text-center transition-colors duration-200',
          // base colours (blue or custom)
          className,
          // always show label: only colour changes when disabled
          'disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed'
        ].join(' ')
    },
    children
  );


/* ───────── Main App ───────── */
function App () {
  /* ───── state ───── */
  const [loading, setLoading]   = useState(true);
  const [busy,    setBusy]      = useState(false); // busy for single job
  const [bulkBusy,setBulkBusy]  = useState(false); // busy for page‑level apply

  const [cfg, setCfg] = useState({
    resume:                null,  // { name, text }
    threshold:             70,
    numApplications:       5,
    remainingApplications: 5,
    creditsLeft:           10,
    applicationsThisWeek:  0,
    lastApplied:           null
  });

  const abortCtl = useRef(new AbortController());

  /* ───── hydrate previous state ───── */
  useEffect(() => {
    chrome.storage.local.get('appState', ({ appState }) => {
      if (appState) {
        const today = new Date().toDateString();
        const reset = !appState.lastApplied || new Date(appState.lastApplied).toDateString() !== today;
        setCfg(prev => ({
          ...prev,
          ...appState,
          creditsLeft:           reset ? 10                 : appState.creditsLeft,
          remainingApplications: reset ? appState.numApplications : appState.remainingApplications
        }));
      }
      setLoading(false);
    });
    return () => abortCtl.current.abort();
  }, []);

  /* ───── persist cfg (debounced) ───── */
  useEffect(() => {
    const t = setTimeout(() => chrome.storage.local.set({ appState: cfg }), 400);
    return () => clearTimeout(t);
  }, [cfg]);

  /* ───── résumé upload ───── */
  const handleResume = useCallback(async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') return alert('Only PDF files allowed');
    if (file.size > 2 * 1024 * 1024)     return alert('File must be < 2 MB');

    try {
      const pdf  = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc   = await page.getTextContent();
        text += tc.items.map(it => it.str).join(' ');
      }
      setCfg(prev => ({
        ...prev,
        resume: { name: file.name, text },
        creditsLeft: 10,
        remainingApplications: prev.numApplications
      }));
    } catch (err) {
      console.error(err);
      alert('Could not parse PDF');
    }
  }, []);

  /* ───── Single‑job Easy Apply ───── */
  const onApply = useCallback(async () => {
    if (!cfg.resume?.text) return alert('Upload your résumé first');
    if (busy || bulkBusy)  return;
    setBusy(true);
    abortCtl.current = new AbortController();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !/linkedin\.com\/jobs\//i.test(tab.url)) throw new Error('Open a LinkedIn job posting first');
      // give the content‑script up to 60 s to finish the wizard
      await sendToTab(tab.id, { type: 'AUTO_APPLY' }, { timeoutMs: 60_000 });
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }, [cfg.resume, busy, bulkBusy]);

  /* ───── One‑click Apply to current feed page ───── */
  const onAutoApplyPage = useCallback(async () => {
    if (!cfg.resume?.text) return alert('Upload your résumé first');
    if (busy || bulkBusy)  return;
    setBulkBusy(true);
    abortCtl.current = new AbortController();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !/linkedin\.com\/jobs/i.test(tab.url)) throw new Error('Open a LinkedIn Jobs page first');
      const resp = await sendToTab(tab.id, {
        type: 'APPLY_TO_ALL_VISIBLE_JOBS',
        resumeText: cfg.resume.text,
        threshold: cfg.threshold
      }, { timeoutMs: 120_000 }); // allow 2 min for bulk runs
      if (resp?.error) throw new Error(resp.error);
      alert(`Finished! Applied to ${resp.appliedCount || 0} job(s).`);
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setBulkBusy(false);
    }
  }, [cfg.resume, cfg.threshold, busy, bulkBusy]);

  /* ───── CSV download ───── */
  const downloadCSV = useCallback(async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GENERATE_REPORT' });
      if (resp?.error) throw new Error(resp.error);
      const url = URL.createObjectURL(new Blob([resp.csvData], { type: 'text/csv' }));
      await chrome.downloads.download({
        url,
        filename: `job-matches-${new Date().toISOString().slice(0, 10)}.csv`,
        saveAs: true
      });
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error(err);
      alert('CSV error: ' + err.message);
    }
  }, []);

  /* ───── Settings Panel ───── */
  const SettingsPanel = () => React.createElement('div', { className: 'w-full space-y-4' }, [
    // Threshold slider
    React.createElement('div', {}, [
      React.createElement('label', { className: 'block text-sm font-medium mb-1' }, `Match Threshold: ${cfg.threshold}%`),
      React.createElement('input', {
        type: 'range', min: 50, max: 95, step: 1, value: cfg.threshold,
        onChange: e => setCfg(p => ({ ...p, threshold: +e.target.value })),
        className: 'w-full accent-blue-500'
      })
    ]),
    // Daily limit
    React.createElement('div', {}, [
      React.createElement('label', { className: 'block text-sm font-medium mb-1' }, 'Daily Applications (1–10)'),
      React.createElement('input', {
        type: 'number', min: 1, max: 10, value: cfg.numApplications,
        onChange: e => {
          const v = Math.min(10, Math.max(1, +e.target.value || 1));
          setCfg(p => ({ ...p, numApplications: v, remainingApplications: v }));
        },
        className: 'w-full px-3 py-2 border rounded focus:ring-blue-500'
      })
    ])
  ]);

  /* Button helper */
  const Button = (props) => React.createElement('button', {
    className: 'w-full px-4 py-2 rounded text-white disabled:cursor-not-allowed ' + props.className,
    disabled: props.disabled,
    onClick: props.onClick
  }, props.children);

  /* ───── render ───── */
  if (!getOpenAIKey()) {
    return React.createElement('div', { className: 'p-4 text-red-600 text-sm' }, [
      'OpenAI key missing. Edit ', React.createElement('code', null, 'utils/api.js'), ' and reload the extension.'
    ]);
  }
  if (loading) {
    return React.createElement('div', { className: 'flex justify-center items-center h-full' }, 'Loading…');
  }

  return React.createElement('div', { className: 'flex flex-col items-center space-y-4 p-3' }, [
    /* Résumé upload */
    React.createElement('label', {
      className: 'w-full cursor-pointer bg-white p-4 rounded-lg border border-dashed border-gray-300 hover:border-blue-500'
    }, [
      React.createElement('input', { type: 'file', accept: '.pdf', className: 'hidden', onChange: handleResume }),
      React.createElement('div', { className: 'text-center' }, cfg.resume ? `✅ ${cfg.resume.name || 'Résumé loaded'}` : 'Upload Résumé (PDF)')
    ]),

    /* Settings panel (unchanged) */
    React.createElement(SettingsPanel),

    /* Action buttons */
    Button({
      className: busy || bulkBusy ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600 text-white',
      disabled: !cfg.resume || busy || bulkBusy,
      onClick: onApply,
      children: busy ? 'Working…' : 'Apply to this job'
    }),

    Button({
      className: bulkBusy ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700 text-white',
      disabled: !cfg.resume || bulkBusy || busy,
      onClick: onAutoApplyPage,
      children: bulkBusy ? 'Applying…' : 'Apply to all visible jobs'
    }),

    Button({
      // <— Download button now keeps its label when inactive
      className: 'bg-gray-100 hover:bg-gray-200 text-black',
      disabled: !cfg.applicationsThisWeek,
      onClick: downloadCSV,
      children: 'Download Weekly Report'
    }),

    /* Stats */
    React.createElement('div', { className: 'text-sm text-gray-600 space-y-1' }, [
      React.createElement('div', null, `Remaining today: ${cfg.remainingApplications}`),
      React.createElement('div', null, `This Week: ${cfg.applicationsThisWeek}`)
    ])
  ]);
}

/* ───── boot ───── */
document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (!root) return console.error('[popup] #root not found');
  ReactDOM.createRoot(root).render(
    React.createElement(ErrorBoundary, null, React.createElement(App, null))
  );
});
