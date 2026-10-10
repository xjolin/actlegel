import Link from 'next/link'
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next'
import Layout from '@/components/Layout'
import { getUsageHistoryData } from '@/lib/usage-history'
import type { UsageHistoryData } from '@/lib/types'

type UsageHistoryPageProps = {
  usageHistory: UsageHistoryData
  loadError: string | null
}

export const getServerSideProps: GetServerSideProps<UsageHistoryPageProps> = async () => {
  try {
    const usageHistory = await getUsageHistoryData()

    return {
      props: {
        usageHistory,
        loadError: null,
      },
    }
  } catch (error) {
    return {
      props: {
        usageHistory: {
          totalAnalysisCount: 0,
          uniqueErrorFileCount: 0,
          weeklyUsageCounts: [],
        },
        loadError: error instanceof Error ? error.message : '加载使用记录失败',
      },
    }
  }
}

function StatCard({
  title,
  value,
  description,
}: {
  title: string
  value: string
  description: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
      <p className="mt-2 text-sm text-gray-500">{description}</p>
    </div>
  )
}

export default function UsageHistoryPage({
  usageHistory,
  loadError,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">使用记录</h1>
            <p className="mt-2 text-sm text-gray-500">
              统计口径：每创建 1 个合同审查任务记为 1 次使用；报错次数按失败状态下的同名文件去重计算。
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            返回主页
          </Link>
        </div>

        {loadError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <StatCard
            title="总共使用合同分析次数"
            value={`${usageHistory.totalAnalysisCount} 次`}
            description="按已创建的合同审查任务总数统计。"
          />
          <StatCard
            title="报错次数"
            value={`${usageHistory.uniqueErrorFileCount} 次`}
            description="同名文件即使多次报错，也只统计 1 次。"
          />
        </div>

        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-gray-900">每周使用次数</h2>
            <p className="mt-1 text-sm text-gray-500">按自然周统计，周一至周日为一个周期。</p>
          </div>

          {usageHistory.weeklyUsageCounts.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">暂无使用记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      统计周期
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      使用次数
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {usageHistory.weeklyUsageCounts.map((item) => (
                    <tr key={item.weekStart}>
                      <td className="px-5 py-4 text-sm text-gray-700">{item.label}</td>
                      <td className="px-5 py-4 text-sm font-medium text-gray-900">{item.count} 次</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}
