export const metadata = {
  title: 'NEXO Framework',
  description: 'Framework proprietário de análise de investimentos',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
