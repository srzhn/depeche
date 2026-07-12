import type { DepecheApi } from '../hooks/useDepeche';
import { PHASE3_ENABLED } from '../lib/audio';

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

        {PHASE3_ENABLED && (
          <>
            <div className="sep">Эквалайзер</div>
            <label className="row slider">
              <span>Низкие: {s.eqLow > 0 ? '+' : ''}{s.eqLow} дБ</span>
              <input type="range" min={-12} max={12} step={1} value={s.eqLow} onChange={(e) => api.setEq(parseFloat(e.target.value), s.eqMid, s.eqHigh)} />
            </label>
            <label className="row slider">
              <span>Средние: {s.eqMid > 0 ? '+' : ''}{s.eqMid} дБ</span>
              <input type="range" min={-12} max={12} step={1} value={s.eqMid} onChange={(e) => api.setEq(s.eqLow, parseFloat(e.target.value), s.eqHigh)} />
            </label>
            <label className="row slider">
              <span>Высокие: {s.eqHigh > 0 ? '+' : ''}{s.eqHigh} дБ</span>
              <input type="range" min={-12} max={12} step={1} value={s.eqHigh} onChange={(e) => api.setEq(s.eqLow, s.eqMid, parseFloat(e.target.value))} />
            </label>
            <div className="seg small">
              <button onClick={() => api.setEq(0, 0, 0)}>Плоско</button>
              <button onClick={() => api.setEq(-12, 4, -8)}>Телефон</button>
              <button onClick={() => api.setEq(4, 0, 3)}>Голос</button>
            </div>

            <label className="row toggle">
              <span>Компрессор (ровнее громкость)</span>
              <input type="checkbox" checked={s.compressor} onChange={(e) => api.setCompressor(e.target.checked)} />
            </label>

            <div className="row">
              <span>Эффект голоса</span>
              <div className="seg small wrap">
                <button className={s.effect === 'none' ? 'on' : ''} onClick={() => api.setEffect('none')}>Нет</button>
                <button className={s.effect === 'soft' ? 'on' : ''} onClick={() => api.setEffect('soft')}>Хрип</button>
                <button className={s.effect === 'hard' ? 'on' : ''} onClick={() => api.setEffect('hard')}>Жёстко</button>
                <button className={s.effect === 'megaphone' ? 'on' : ''} onClick={() => api.setEffect('megaphone')}>Мегафон</button>
              </div>
            </div>
          </>
        )}

        <label className="row toggle">
          <span>Слушать себя (для настройки)</span>
          <input type="checkbox" checked={s.monitor} onChange={(e) => api.setMonitor(e.target.checked)} />
        </label>

        {PHASE3_ENABLED && api.recordSupported && (
          <>
            <div className="sep">Запись</div>
            <button className={api.recording ? 'primary sm rec' : 'ghost sm'} onClick={api.toggleRecording}>
              {api.recording ? '⏹ Остановить и скачать' : '⏺ Записать разговор (локально)'}
            </button>
            <p className="hint2">Запись идёт только у тебя в браузере и сохраняется файлом. Сервер ничего не пишет.</p>
          </>
        )}

        <button className="ghost sm" onClick={api.refreshDevices}>Обновить список устройств</button>
      </div>
    </div>
  );
}
