import type { DepecheApi } from '../hooks/useDepeche';

export function Settings({ api, onClose }: { api: DepecheApi; onClose: () => void }) {
  const s = api.settings;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h3>Настройки звука</h3>
          <button className="x" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <label className="row">
          <span>Микрофон</span>
          <select value={s.micDeviceId} onChange={(e) => api.setMicDevice(e.target.value)}>
            <option value="">По умолчанию</option>
            {api.devices.mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Микрофон'}</option>)}
          </select>
        </label>

        <label className="row">
          <span>Вывод звука</span>
          <select value={s.outputDeviceId} onChange={(e) => api.setOutputDevice(e.target.value)}>
            <option value="">По умолчанию</option>
            {api.devices.outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Устройство'}</option>)}
          </select>
        </label>

        <div className="row">
          <span>Режим</span>
          <div className="seg">
            <button className={!s.echoCancellation ? 'on' : ''} onClick={() => api.setEchoCancellation(false)}>🎧 Наушники</button>
            <button className={s.echoCancellation ? 'on' : ''} onClick={() => api.setEchoCancellation(true)}>🔊 Колонки</button>
          </div>
        </div>
        <p className="hint2">Колонки — с эхоподавлением (без «завязки»). Наушники — чище звук без него.</p>

        <label className="row toggle">
          <span>Шумоподавление (браузерное)</span>
          <input type="checkbox" checked={s.noiseSuppression} onChange={(e) => api.setNoiseSuppression(e.target.checked)} />
        </label>
        <label className="row toggle">
          <span>Авто-громкость (AGC)</span>
          <input type="checkbox" checked={s.autoGainControl} onChange={(e) => api.setAutoGainControl(e.target.checked)} />
        </label>

        <label className="row slider">
          <span>Усиление микрофона: {Math.round(s.micGain * 100)}%</span>
          <input type="range" min={0} max={2} step={0.05} value={s.micGain} onChange={(e) => api.setMicGain(parseFloat(e.target.value))} />
        </label>

        <label className="row toggle">
          <span>Шумовой гейт</span>
          <input type="checkbox" checked={s.gateEnabled} onChange={(e) => api.setGate(e.target.checked)} />
        </label>
        {s.gateEnabled && (
          <label className="row slider">
            <span>Порог гейта: {Math.round(s.gateThreshold * 1000)}</span>
            <input type="range" min={0} max={0.1} step={0.005} value={s.gateThreshold} onChange={(e) => api.setGate(true, parseFloat(e.target.value))} />
          </label>
        )}

        <label className="row toggle">
          <span>Слушать себя (для настройки)</span>
          <input type="checkbox" checked={s.monitor} onChange={(e) => api.setMonitor(e.target.checked)} />
        </label>

        <button className="ghost sm" onClick={api.refreshDevices}>Обновить список устройств</button>
      </div>
    </div>
  );
}
