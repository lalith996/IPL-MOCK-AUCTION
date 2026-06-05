"use client";

import React from "react";

interface AdminErrorBoundaryProps {
  children: React.ReactNode;
}

interface AdminErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
  errorId: string | null;
}

interface ClientErrorReport {
  message: string;
  stack?: string | undefined;
  componentStack?: string | undefined;
  source: string;
  url: string;
  userAgent: string;
  timestamp: string;
  errorId: string;
}

function buildErrorReport(error: Error, source: string, componentStack?: string): ClientErrorReport {
  return {
    message: error.message,
    stack: error.stack,
    componentStack,
    source,
    url: window.location.href,
    userAgent: window.navigator.userAgent,
    timestamp: new Date().toISOString(),
    errorId: crypto.randomUUID(),
  };
}

function sendErrorReport(report: ClientErrorReport): void {
  const payload = JSON.stringify(report);
  const endpoint = "/api/monitoring/client-errors";

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }));
    return;
  }

  void fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Monitoring should never break the UI fallback.
  });
}

function MonitoringBootstrap(): React.JSX.Element {
  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const error = event.error instanceof Error ? event.error : new Error(event.message);
      sendErrorReport(buildErrorReport(error, "window.error"));
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error
        ? event.reason
        : new Error(typeof event.reason === "string" ? event.reason : "Unhandled promise rejection");
      sendErrorReport(buildErrorReport(reason, "unhandledrejection"));
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return <></>;
}

export class AdminErrorBoundary extends React.Component<
  AdminErrorBoundaryProps,
  AdminErrorBoundaryState
> {
  public override state: AdminErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
    errorId: null,
  };

  static getDerivedStateFromError(error: Error): AdminErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message,
      errorId: crypto.randomUUID(),
    };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    sendErrorReport(
      buildErrorReport(error, "react.error-boundary", errorInfo.componentStack ?? undefined),
    );
    console.error("Admin UI error boundary captured an error", {
      errorId: this.state.errorId,
      message: error.message,
    });
  }

  private handleRetry = (): void => {
    this.setState({
      hasError: false,
      errorMessage: null,
      errorId: null,
    });
    window.location.reload();
  };

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
          <div className="max-w-lg w-full rounded-2xl border border-red-900/60 bg-gray-900 p-6 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.2em] text-red-300">Admin console error</p>
            <h1 className="mt-2 text-xl font-semibold text-white">Something broke in the admin UI</h1>
            <p className="mt-3 text-sm leading-6 text-gray-300">
              The interface recovered into the boundary and the error was reported automatically.
            </p>
            <div className="mt-4 rounded-lg border border-gray-700 bg-gray-950/80 px-3 py-2 font-mono text-xs text-red-300">
              {this.state.errorMessage ?? "Unknown error"}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={this.handleRetry}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => window.location.assign("/")}
                className="rounded-md border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-800"
              >
                Return home
              </button>
            </div>
            {this.state.errorId && (
              <p className="mt-4 text-xs text-gray-500">Error ID: {this.state.errorId}</p>
            )}
          </div>
        </div>
      );
    }

    return (
      <>
        <MonitoringBootstrap />
        {this.props.children}
      </>
    );
  }
}
