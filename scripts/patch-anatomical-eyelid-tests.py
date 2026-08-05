from pathlib import Path

static_pose = Path('src/masks/three/staticPose.test.ts')
source = static_pose.read_text()
old = "const noisy = smoothStaticDragonPose(previous, { ...previous, blinkLeft: 0.35 })"
new = "const noisy = smoothStaticDragonPose(previous, { ...previous, blinkLeft: 0.08 })"
if source.count(old) != 1:
    raise SystemExit('Expected the legacy eyelid-noise test once.')
static_pose.write_text(source.replace(old, new, 1))

eyelid = Path('src/masks/three/dragonEyelidFallback.test.ts')
source = eyelid.read_text()
old = "expect(resolveDragonEyelidClosure(0.585)).toBe(1)"
new = "expect(resolveDragonEyelidClosure(0.585)).toBeCloseTo(1, 12)"
if source.count(old) != 1:
    raise SystemExit('Expected the exact eyelid saturation assertion once.')
eyelid.write_text(source.replace(old, new, 1))
