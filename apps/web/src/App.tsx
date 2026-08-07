import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import ValidatorView from './pages/ValidatorView'
import PlaygroundView from './pages/PlaygroundView'
import UnifiedView from './pages/UnifiedView'

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
          <NavLink to="/playground" className={navLinkClass}>Instruments</NavLink>
          <NavLink to="/validator" className={navLinkClass}>Validator</NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/unified" replace />} />
        <Route path="/validator" element={<ValidatorView />} />
        <Route path="/playground" element={<PlaygroundView />} />
        <Route path="/unified" element={<UnifiedView />} />
        <Route path="*" element={<Navigate to="/unified" replace />} />
      </Routes>
    </main>
  )
}

export default App
