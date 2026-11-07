import "./style.css";
export const metadata = {
  title: "Freedom · Аналитика диалогов",
  referrer: "no-referrer" as const,
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
