// Last line of defence: a rendering error shows a readable message instead of a blank page.
import React from 'react';

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Studio error:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="studio-crash" role="alert">
      <h1>Something went wrong in the Studio</h1>
      <p>{this.state.error.message}</p>
      <p>Your generations are saved on the server; reload to continue, and send this message with a screenshot if it repeats.</p>
      <button type="button" onClick={() => location.reload()}>Reload</button>
    </div>;
  }
}
