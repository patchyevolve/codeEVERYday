export default function LoadingState({ label }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" aria-hidden="true" />
        <p className="text-sm text-gray-500" role="status" aria-live="polite">
          {label ?? "Loading..."}
        </p>
      </div>
    </div>
  );
}
