import Link from 'next/link'

export default function Layout({
  children,
  showHeader = true
}: {
  children: React.ReactNode
  showHeader?: boolean
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {showHeader && (
        <header className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center">
            <Link href="/" className="flex items-center gap-2 text-gray-900 hover:text-primary-light transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-lg font-semibold">ActLegal</span>
            </Link>
            <span className="ml-2 text-sm text-gray-400">合同审查系统</span>
          </div>
        </header>
      )}
      <main>{children}</main>
    </div>
  )
}
