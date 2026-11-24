import './globals.css';

export const metadata = {
  title: 'Polymarket 5m BTC Up/Down Bot',
  description: 'Real-time Monte Carlo trading bot & dashboard for Polymarket rolling 5-minute BTC markets',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
