import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import ValidatorView from './pages/ValidatorView'
import PlaygroundView from './pages/PlaygroundView'

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'app-nav-link active' : 'app-nav-link'
}

function App() {
  return (
    <main className="app-shell">
      <nav className="app-nav">
        <NavLink to="/validator" className={navLinkClass}>Validator</NavLink>
        <NavLink to="/playground" className={navLinkClass}>Playground</NavLink>
      </nav>

      <Routes>
        <Route path="/" element={<Navigate to="/validator" replace />} />
        <Route path="/validator" element={<ValidatorView />} />
        <Route path="/playground" element={<PlaygroundView />} />
        <Route path="*" element={<Navigate to="/validator" replace />} />
      </Routes>
    </main>
  )
}

export default App
