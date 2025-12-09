import { useState } from 'react'
import { useAccountsStore } from '@/store/accounts'
import { AccountToolbar } from './AccountToolbar'
import { AccountGrid } from './AccountGrid'
import { AddAccountDialog } from './AddAccountDialog'
import { EditAccountDialog } from './EditAccountDialog'
import { GroupManageDialog } from './GroupManageDialog'
import { TagManageDialog } from './TagManageDialog'
import { ExportDialog } from './ExportDialog'
import { Button } from '../ui'
import type { Account } from '@/types/account'
import { ArrowLeft, Loader2 } from 'lucide-react'

interface AccountManagerProps {
  onBack?: () => void
}

export function AccountManager({ onBack }: AccountManagerProps): React.ReactNode {
  const {
    isLoading,
    accounts,
    importFromExportData,
    selectedIds
  } = useAccountsStore()

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [showGroupDialog, setShowGroupDialog] = useState(false)
  const [showTagDialog, setShowTagDialog] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [isFilterExpanded, setIsFilterExpanded] = useState(false)

  // 获取要导出的账号列表
  const getExportAccounts = () => {
    const accountList = Array.from(accounts.values())
    if (selectedIds.size > 0) {
      return accountList.filter(acc => selectedIds.has(acc.id))
    }
    return accountList
  }

  // 导出
  const handleExport = (): void => {
    setShowExportDialog(true)
  }

  // 导入
  const handleImport = async (): Promise<void> => {
    const content = await window.api.importFromFile()

    if (content) {
      try {
        const data = JSON.parse(content)

        if (data.version && data.accounts) {
          const result = importFromExportData(data)
          const skippedInfo = result.errors.find(e => e.id === 'skipped')
          const skippedMsg = skippedInfo ? `，${skippedInfo.error}` : ''
          alert(`导入完成：成功 ${result.success} 个${skippedMsg}`)
        } else {
          alert('无效的导入文件格式')
        }
      } catch {
        alert('解析导入文件失败')
      }
    }
  }

  // 管理分组
  const handleManageGroups = (): void => {
    setShowGroupDialog(true)
  }

  // 管理标签
  const handleManageTags = (): void => {
    setShowTagDialog(true)
  }

  // 编辑账号
  const handleEditAccount = (account: Account): void => {
    setEditingAccount(account)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">加载账号数据...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部工具栏 */}
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b bg-background">
        <div className="flex items-center gap-4">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-lg font-semibold">账户管理</h1>
        </div>
        
        {/* 工具栏 */}
        <AccountToolbar
          onAddAccount={() => setShowAddDialog(true)}
          onImport={handleImport}
          onExport={handleExport}
          onManageGroups={handleManageGroups}
          onManageTags={handleManageTags}
          isFilterExpanded={isFilterExpanded}
          onToggleFilter={() => setIsFilterExpanded(!isFilterExpanded)}
        />
      </header>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-hidden flex flex-col px-6 py-4 gap-4">
        {/* 账号网格 */}
        <div className="flex-1 overflow-hidden">
          <AccountGrid
            onAddAccount={() => setShowAddDialog(true)}
            onEditAccount={handleEditAccount}
          />
        </div>
      </div>

      {/* 添加账号对话框 */}
      <AddAccountDialog
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
      />

      {/* 编辑账号对话框 */}
      <EditAccountDialog
        open={!!editingAccount}
        onOpenChange={(open) => !open && setEditingAccount(null)}
        account={editingAccount}
      />

      {/* 分组管理对话框 */}
      <GroupManageDialog
        isOpen={showGroupDialog}
        onClose={() => setShowGroupDialog(false)}
      />

      {/* 标签管理对话框 */}
      <TagManageDialog
        isOpen={showTagDialog}
        onClose={() => setShowTagDialog(false)}
      />

      {/* 导出对话框 */}
      <ExportDialog
        open={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        accounts={getExportAccounts()}
        selectedCount={selectedIds.size}
      />
    </div>
  )
}
