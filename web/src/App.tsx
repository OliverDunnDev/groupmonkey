import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ApiError } from './api/client'
import { AuthProvider } from './auth'
import Shell from './components/Shell'
import Board from './pages/Board'
import Agents from './pages/Agents'
import AiSettings from './pages/AiSettings'
import Dashboard from './pages/Dashboard'
import Goals from './pages/Goals'
import Groups from './pages/Groups'
import Login from './pages/Login'
import Overview from './pages/Overview'
import ProjectPage from './pages/ProjectPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Don't retry client errors (401/403/404); they won't fix themselves.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Shell />}>
              <Route index element={<Dashboard />} />
              <Route path="agents" element={<Agents />} />
              <Route path="admin/ai" element={<AiSettings />} />
              <Route path="projects/:id" element={<ProjectPage />}>
                <Route index element={<Overview />} />
                <Route path="board" element={<Board />} />
                <Route path="groups" element={<Groups />} />
                <Route path="goals" element={<Goals />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
