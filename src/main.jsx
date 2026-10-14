import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App.jsx';
import { useStore, applyTheme, hasPendingSave } from './store.js';

applyTheme(useStore.getState().theme);
// Don't lose a change that is still waiting for its save when the tab is closed or reloaded.
window.addEventListener('pagehide', () => { if (hasPendingSave()) useStore.getState().flushNow(true); });
// In 'system' mode, follow the computer's light/dark switch while the app is open.
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => useStore.setState({ _sys: Date.now() })); } catch { /* old browsers */ } // before first paint, so there's no flash of the wrong theme

class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="center"><div className="warn" style={{ maxWidth: 560 }}><b>Something broke while drawing this account.</b><br />{String(this.state.err.message || this.state.err)}<br /><br /><button className="btn sm" onClick={() => location.reload()}>Reload</button></div></div>;
  }
}
createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);
