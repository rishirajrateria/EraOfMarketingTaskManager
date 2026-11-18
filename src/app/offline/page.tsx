export default function OfflinePage() {
  return (
    <main className="phone-frame items-center justify-center p-8 text-center">
      <div>
        <div className="text-5xl">📡</div>
        <h1 className="mt-4 text-lg font-semibold">You are offline</h1>
        <p className="mt-2 text-sm text-gray-600">The task list needs a connection. Reconnect and pull to refresh.</p>
      </div>
    </main>
  );
}
