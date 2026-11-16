import "./globals.css";

export const metadata = {
  title: "Koya Clinic | Book an appointment",
  description: "Book and manage your Koya Clinic appointment.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
