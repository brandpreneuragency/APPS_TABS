import { createRoot } from 'react-dom/client'
import './index.css'
import i18n from './i18n'
import { isClientsAcceptanceRuntime, tasksAcceptanceFixture } from './services/runtime'

// Do not evaluate App or its stores/migrations/updater in the isolated probe.
async function mountApplication() {
  const isolated = isClientsAcceptanceRuntime()
  if (isolated) await i18n.changeLanguage('tr')
  const { default: Root } = tasksAcceptanceFixture()
    ? await import('./components/taskManager/acceptance/TaskAcceptanceApp')
    : isolated
    ? await import('./components/clients/acceptance/AcceptanceApp')
    : await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(<Root />)
}

void mountApplication()
