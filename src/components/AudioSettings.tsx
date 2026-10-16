import { useEffect, useRef, useState } from 'react'
import { AudioLines, ChevronUp, Headphones, Mic, Settings2, SlidersHorizontal } from 'lucide-react'
import { Modal } from './ui'
import {
  canSelectAudioOutput,
  updateAudioPreferences,
  useAudioPreferences,
} from '../lib/audio-preferences'
import type { AudioPreferences } from '../lib/audio-preferences'
import { useAudioDevices } from '../hooks/useAudioDevices'
import { useMicrophoneTest } from '../hooks/useMicrophoneTest'

function DeviceSelect({
  kind,
  devices,
  value,
  onChange,
}: {
  kind: 'audioinput' | 'audiooutput'
  devices: MediaDeviceInfo[]
  value: string
  onChange: (value: string) => void
}) {
  const input = kind === 'audioinput'
  const available = devices.filter(
    (device) => device.kind === kind && device.deviceId && device.deviceId !== 'default',
  )
  return (
    <label className="audio-field">
      <span>{input ? 'Dispositivo de entrada' : 'Dispositivo de saída'}</span>
      <div className="audio-device-select">
        {input ? <Mic size={18} /> : <Headphones size={18} />}
        <select
          value={value}
          disabled={!input && !canSelectAudioOutput()}
          onChange={(event) => onChange(event.target.value)}
          aria-label={input ? 'Dispositivo de entrada' : 'Dispositivo de saída'}
        >
          <option value="default">Padrão do sistema</option>
          {value !== 'default' && !available.some((device) => device.deviceId === value) && (
            <option value={value}>Dispositivo salvo · indisponível</option>
          )}
          {available.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `${input ? 'Microfone' : 'Alto-falante'} ${index + 1}`}
            </option>
          ))}
        </select>
      </div>
    </label>
  )
}

function VolumeSlider({ input, value }: { input?: boolean; value: number }) {
  return (
    <label className="audio-field audio-volume">
      <span>
        {input ? 'Volume de entrada' : 'Volume de saída'}{' '}
        <output>{Math.round(value * 100)}%</output>
      </span>
      <input
        aria-label={input ? 'Volume de entrada' : 'Volume de saída'}
        type="range"
        min="0"
        max={input ? '200' : '100'}
        step="1"
        value={Math.round(value * 100)}
        onChange={(event) =>
          updateAudioPreferences({
            [input ? 'inputVolume' : 'outputVolume']: Number(event.target.value) / 100,
          })
        }
      />
    </label>
  )
}

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  return (
    <div
      className="audio-meter"
      role="meter"
      aria-label="Nível de entrada"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      aria-valuetext={active ? `${Math.round(level * 100)}%` : 'Teste parado'}
    >
      {Array.from({ length: 48 }, (_, index) => (
        <i
          key={index}
          className={active && index / 48 < level ? (index > 41 ? 'peak' : 'lit') : ''}
        />
      ))}
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  change,
}: {
  label: string
  description: string
  checked: boolean
  change: (value: boolean) => void
}) {
  return (
    <label className="audio-toggle">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => change(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  )
}

export function AudioSettings({ close }: { close: () => void }) {
  return (
    <Modal title="Voz e áudio" close={close} className="audio-settings-modal">
      <AudioSettingsContent />
    </Modal>
  )
}

export function AudioSettingsContent() {
  const preferences = useAudioPreferences()
  const { devices, error, authorize, refresh } = useAudioDevices()
  const test = useMicrophoneTest(preferences)
  const custom = (patch: Partial<AudioPreferences>) =>
    updateAudioPreferences({ ...patch, profile: 'custom' })
  return (
    <div className="audio-settings">
      <div className="audio-settings-intro">
        <span>
          <AudioLines size={25} />
        </span>
        <div>
          <h3>Sua voz, do seu jeito.</h3>
          <p>Ajuste seus dispositivos e encontre o som ideal para a conversa.</p>
        </div>
      </div>
      <div className="audio-device-grid">
        <div>
          <DeviceSelect
            kind="audioinput"
            devices={devices}
            value={preferences.inputDevice}
            onChange={(inputDevice) => updateAudioPreferences({ inputDevice })}
          />
          <VolumeSlider input value={preferences.inputVolume} />
        </div>
        <div>
          <DeviceSelect
            kind="audiooutput"
            devices={devices}
            value={preferences.outputDevice}
            onChange={(outputDevice) => updateAudioPreferences({ outputDevice })}
          />
          <VolumeSlider value={preferences.outputVolume} />
        </div>
      </div>
      <div className="audio-device-help">
        <button onClick={() => void authorize()}>Permitir acesso e atualizar dispositivos</button>
        <span>Preferências salvas neste dispositivo.</span>
      </div>
      {!canSelectAudioOutput() && (
        <p className="audio-help">
          Este navegador usa a saída padrão. Escolha outro alto-falante nas configurações do
          sistema.
        </p>
      )}
      <section className="audio-test" aria-label="Teste do microfone">
        <div className="audio-test-row">
          <button
            className={test.running ? 'secondary' : 'primary'}
            disabled={test.busy}
            onClick={() => {
              if (test.running) test.stop()
              else void test.start().then(refresh)
            }}
          >
            <Mic size={17} />
            {test.busy ? 'Abrindo microfone…' : test.running ? 'Parar teste' : 'Teste do microfone'}
          </button>
          <LevelMeter level={test.level} active={test.running} />
        </div>
        <p>Fale normalmente para conferir o nível da sua voz com os ajustes aplicados.</p>
        {test.running && (
          <button
            className="audio-listen"
            aria-pressed={test.listening}
            onClick={() => void test.toggleListening()}
          >
            <Headphones size={16} />
            {test.listening ? 'Parar de ouvir minha voz' : 'Ouvir minha voz'}
            <small>Use fones para evitar retorno.</small>
          </button>
        )}
        {!test.enhanced && test.running && (
          <p role="status">
            Tratamento adicional indisponível. O teste usa o processamento disponível no navegador.
          </p>
        )}
      </section>
      {(error || test.error) && (
        <p className="audio-error" role="alert">
          {error || test.error}
        </p>
      )}
      <fieldset className="audio-profiles">
        <legend>Perfil de entrada</legend>
        {(
          [
            [
              'voice',
              'Foco na voz',
              'Supressão neural de ruído, controle de eco e volume de voz equilibrado.',
            ],
            [
              'studio',
              'Estúdio',
              'Áudio sem filtros de voz. Ideal para música; prefira usar fones.',
            ],
            ['custom', 'Personalizado', 'Escolha o tratamento e a sensibilidade do seu microfone.'],
          ] as const
        ).map(([value, label, description]) => (
          <label key={value} className={preferences.profile === value ? 'selected' : ''}>
            <input
              type="radio"
              name="audio-profile"
              value={value}
              checked={preferences.profile === value}
              onChange={() => updateAudioPreferences({ profile: value })}
            />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {preferences.profile === 'custom' && (
        <section className="audio-advanced" aria-label="Tratamento personalizado">
          <label className="audio-field">
            <span>Supressão de ruído</span>
            <select
              value={preferences.noiseSuppression}
              onChange={(event) =>
                custom({
                  noiseSuppression: event.target.value as AudioPreferences['noiseSuppression'],
                })
              }
            >
              <option value="balanced">Equilibrada · recomendada</option>
              <option value="strong">Intensa · ambientes barulhentos</option>
              <option value="off">Desligada</option>
            </select>
          </label>
          <p className="audio-help">
            A redução intensa pode atenuar falas muito baixas. Use o teste para comparar.
          </p>
          <Toggle
            label="Sensibilidade automática"
            description="Adapta a redução de ruído nas pausas à intensidade do ambiente."
            checked={preferences.autoSensitivity}
            change={(autoSensitivity) => custom({ autoSensitivity })}
          />
          {!preferences.autoSensitivity && (
            <label className="audio-field">
              <span>
                Limiar de entrada <output>{preferences.sensitivity} dB</output>
              </span>
              <input
                aria-label="Limiar de entrada"
                type="range"
                min="-70"
                max="-20"
                value={preferences.sensitivity}
                onChange={(event) => custom({ sensitivity: Number(event.target.value) })}
              />
              <small>
                Valores menores preservam vozes mais baixas. Atua com a supressão ligada.
              </small>
            </label>
          )}
          <Toggle
            label="Cancelamento de eco"
            description="Reduz o som dos alto-falantes que retorna ao microfone."
            checked={preferences.echoCancellation}
            change={(echoCancellation) => custom({ echoCancellation })}
          />
          <Toggle
            label="Ganho automático"
            description="Ajuda a manter o volume da voz consistente."
            checked={preferences.autoGainControl}
            change={(autoGainControl) => custom({ autoGainControl })}
          />
        </section>
      )}
      <div className="audio-settings-note">
        <SlidersHorizontal size={16} />
        <span>
          Os ajustes são aplicados à sua voz nas chamadas. Cada participante controla o próprio
          microfone.
        </span>
      </div>
    </div>
  )
}

export function AudioQuickControls({ openSettings }: { openSettings: () => void }) {
  const [open, setOpen] = useState<'input' | 'output' | null>(null)
  const preferences = useAudioPreferences()
  const { devices, authorize, error, refresh } = useAudioDevices()
  const test = useMicrophoneTest(preferences)
  const root = useRef<HTMLDivElement>(null)
  const inputButton = useRef<HTMLButtonElement>(null)
  const outputButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) {
      test.stop()
      return
    }
    void refresh()
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(null)
        ;(open === 'input' ? inputButton : outputButton).current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open, refresh])
  return (
    <div className="audio-quick-controls" ref={root}>
      <button
        ref={inputButton}
        aria-label="Configurações de entrada"
        title="Configurações de entrada"
        aria-expanded={open === 'input'}
        onClick={() => {
          test.stop()
          setOpen(open === 'input' ? null : 'input')
        }}
      >
        <Mic size={17} />
        <ChevronUp size={11} />
      </button>
      <button
        ref={outputButton}
        aria-label="Configurações de saída"
        title="Configurações de saída"
        aria-expanded={open === 'output'}
        onClick={() => {
          test.stop()
          setOpen(open === 'output' ? null : 'output')
        }}
      >
        <Headphones size={17} />
        <ChevronUp size={11} />
      </button>
      {open && (
        <div
          className="audio-quick-popover"
          role="dialog"
          aria-label={open === 'input' ? 'Entrada de áudio' : 'Saída de áudio'}
        >
          <DeviceSelect
            kind={open === 'input' ? 'audioinput' : 'audiooutput'}
            devices={devices}
            value={open === 'input' ? preferences.inputDevice : preferences.outputDevice}
            onChange={(value) =>
              updateAudioPreferences({ [open === 'input' ? 'inputDevice' : 'outputDevice']: value })
            }
          />
          <button className="audio-device-refresh" onClick={() => void authorize()}>
            Atualizar dispositivos
          </button>
          {open === 'input' && (
            <label className="audio-field">
              <span>Perfil de entrada</span>
              <select
                value={preferences.profile}
                onChange={(event) =>
                  updateAudioPreferences({
                    profile: event.target.value as AudioPreferences['profile'],
                  })
                }
              >
                <option value="voice">Foco na voz</option>
                <option value="studio">Estúdio</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>
          )}
          <VolumeSlider
            input={open === 'input'}
            value={open === 'input' ? preferences.inputVolume : preferences.outputVolume}
          />
          {open === 'input' && (
            <div className="audio-quick-meter">
              <span>Nível de entrada</span>
              <LevelMeter level={test.level} active={test.running} />
              <button
                disabled={test.busy}
                onClick={() => (test.running ? test.stop() : void test.start())}
              >
                {test.running ? 'Parar teste' : 'Testar entrada'}
              </button>
            </div>
          )}
          {open === 'output' && !canSelectAudioOutput() && (
            <p className="audio-help">Selecione a saída nas configurações do sistema.</p>
          )}
          {(error || test.error) && (
            <p className="audio-error" role="alert">
              {error || test.error}
            </p>
          )}
          <button
            className="audio-open-settings"
            onClick={() => {
              test.stop()
              setOpen(null)
              openSettings()
            }}
          >
            <Settings2 size={18} />
            Configurações de voz
          </button>
        </div>
      )}
    </div>
  )
}
