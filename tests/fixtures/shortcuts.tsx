import { useState } from 'react'
import { useShortcut } from '../../src/lib/shortcuts'
export function ShortcutHarness() {
  const [count, setCount] = useState(0)
  useShortcut('microphone', () => setCount(value => value + 1))
  return <div><output id="shortcut-count">{count}</output><input id="shortcut-input" /></div>
}
