(() => {
  const originalGet = Map.prototype.get
  const originalHas = Map.prototype.has

  const isFaceBlendshapeMap = (map) => (
    originalHas.call(map, 'eyeBlinkLeft')
    || originalHas.call(map, 'eyeBlinkRight')
  )

  const blinkEnergy = (map) => Math.max(
    Number(originalGet.call(map, 'eyeBlinkLeft') ?? 0),
    Number(originalGet.call(map, 'eyeBlinkRight') ?? 0),
  )

  Object.defineProperty(Map.prototype, 'get', {
    configurable: true,
    writable: true,
    value(key) {
      if (
        (key === 'jawOpen' || key === 'mouthClose')
        && isFaceBlendshapeMap(this)
        && blinkEnergy(this) >= 0.28
      ) {
        return key === 'jawOpen' ? 0 : 1
      }

      return originalGet.call(this, key)
    },
  })

  Object.defineProperty(window, '__FACECAM_BLINK_MOUTH_HOTFIX__', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: 'c663d5d56b2cd56b8acae8b609619326353213ab',
  })
})()
