import StatusBanner from './StatusBanner.js';

// Shows the standard error message from the API. Never a stack trace: servers do not send one.
export default function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return <StatusBanner variant="error" message={message} onDismiss={onDismiss} dismissAriaLabel="Dismiss error" />;
}
