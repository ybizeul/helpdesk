import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider, Switch, Tooltip, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { BrowserRouter } from 'react-router-dom'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './app.css'
import App from './App.tsx'

const theme = createTheme({
  components: {
    Switch: Switch.extend({
      defaultProps: {
        // ✅ Disable withThumbIndicator if you want to use old styles
        withThumbIndicator: false,
      },
    }),
    Tooltip: Tooltip.extend({
      defaultProps: {
        withArrow: true,
      },
      styles: () => ({
        tooltip: {
          backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))',
          color: 'light-dark(var(--mantine-color-dark-8), var(--mantine-color-gray-0))',
          border: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.18)',
        },
        arrow: {
          borderColor: 'light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
        },
      }),
    }),
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MantineProvider>
  </StrictMode>,
)
