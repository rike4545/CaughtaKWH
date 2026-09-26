import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('CaughtaKWH render failure', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="fatalError" role="alert">
        <div className="fatalErrorCard">
          <p className="eyebrow">CaughtaKWH</p>
          <h1>Something went wrong.</h1>
          <p>
            Your browser hit an unexpected display error. No charging or location data was changed.
          </p>
          <div className="fatalErrorActions">
            <button type="button" onClick={() => window.location.reload()}>Reload dashboard</button>
            <a href="./">Return home</a>
          </div>
          <details>
            <summary>Technical details</summary>
            <code>{this.state.error?.message || 'Unknown rendering error'}</code>
          </details>
        </div>
      </main>
    );
  }
}
