import './App.css'
import { MAVLINK_FIELDS, MAVLINK_FIELD_KEYS } from './constants/mavlinkInputs'

function App() {
  return (
    <main className="app-shell">
      <section className="header">
        <p className="eyebrow">Infrastructure only</p>
        <h1>Canonical MAVLink Field Registry</h1>
        <p className="intro">
          Algorithm implementation removed. This app now exposes only real MAVLink message fields.
        </p>
      </section>

      <section className="panel">
        <table className="mapping-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Message</th>
              <th>Field</th>
              <th>Units</th>
              <th>Value Type</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {MAVLINK_FIELD_KEYS.map((key) => {
              const entry = MAVLINK_FIELDS[key]

              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{entry.message}</td>
                  <td>{entry.field}</td>
                  <td>{entry.units}</td>
                  <td>{entry.valueType}</td>
                  <td>{entry.notes}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </main>
  )
}

export default App
