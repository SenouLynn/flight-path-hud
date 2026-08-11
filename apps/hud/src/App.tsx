import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import '@flight-path-hud/hud-ui/hud.css'
import './App.css'
import GcsView from './pages/GcsView'
import UnifiedView from './pages/UnifiedView'
import ValidatorView from './pages/ValidatorView'

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'app-nav-link active' : 'app-nav-link'
}

function App() {
  return (
    <main className="app-shell">
      <header className="app-chrome">
        <p className="app-title">HUD Parameter Playground</p>
        <nav className="app-nav" aria-label="Application views">
          <NavLink to="/unified" className={navLinkClass}>Unified HUD</NavLink>
          <NavLink to="/gcs" className={navLinkClass}>GCS Ops</NavLink>
          <NavLink to="/validator" className={navLinkClass}>Validator</NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/unified" replace />} />
        <Route path="/validator" element={<ValidatorView />} />
        <Route path="/gcs" element={<GcsView />} />
        <Route path="/playground" element={<Navigate to="/gcs" replace />} />
        <Route path="/unified" element={<UnifiedView />} />
        <Route path="*" element={<Navigate to="/unified" replace />} />
      </Routes>
    </main>
  )
}

export default App
