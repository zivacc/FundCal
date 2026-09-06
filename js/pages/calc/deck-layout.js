/** 展示台的弧形轨道：中心最大，向两侧后退，最多呈现近旁五张。 */
export function deckPose(offset, cardWidth, viewportWidth) {
  const distance = Math.abs(offset);
  const side = Math.sign(offset);
  const step = Math.min(cardWidth * .78, viewportWidth * .28);
  return {
    x: side * step * distance * 1.12 / (1 + distance * .12),
    y: Math.min(distance, 3) * 26,
    z: distance ? -Math.min(distance, 4) * 165 : 0,
    angle: -side * Math.min(distance * 42, 68),
    scale: Math.max(.55, 1 - distance * .13),
    opacity: distance <= 2 ? 1 : Math.max(0, 3 - distance),
    light: Math.max(.48, 1 - distance * .18),
  };
}
export const clampDeckIndex = (index, count) => Math.max(0, Math.min(Math.max(0, count - 1), index));
