import { Link } from "react-router-dom";

export function PlaceholderPage({ title, message }: { title: string; message: string }) {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{title}</h1>
        <Link to="/">Back to menu</Link>
      </div>
      <div className="card card-status">
        <p>{message}</p>
      </div>
    </div>
  );
}
