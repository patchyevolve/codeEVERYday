import { useNavigate } from "react-router-dom";

interface PageHeaderProps {
  title: string;
  backTo?: string;
  backLabel?: string;
  right?: React.ReactNode;
}

export default function PageHeader({ title, backTo, backLabel, right }: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {backTo && (
            <button
              onClick={() => navigate(backTo)}
              className="text-primary-600 hover:underline text-sm shrink-0"
            >
              {backLabel ?? "\u2190 Dashboard"}
            </button>
          )}
          <h1 className="text-lg font-semibold truncate">{title}</h1>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </header>
  );
}
