import { Link } from "react-router-dom";

export function PlaceholderPage({ title, message }: { title: string; message: string }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p>{message}</p>
      <Link to="/">Back to menu</Link>
    </div>
  );
}
