/** 留出两侧后排的展示空间，宽屏前排可并排 2–4 张。 */
export function deckFrontCount(viewportWidth, cardWidth, count) {
  return Math.min(Math.max(1, count), Math.max(1, Math.min(4, Math.floor((viewportWidth - 150) / (cardWidth + 22)))));
}

/** 前排正面等大平铺；超出前排的卡片沿弧线向后退。 */
export function deckPose(offset, cardWidth, viewportWidth, frontCount = 1) {
  const side = Math.sign(offset);
  const half = (frontCount - 1) / 2;
  const distance = Math.max(0, Math.abs(offset) - half);
  const step = Math.min(cardWidth * .78, viewportWidth * .28);
  return {
    x: distance ? side * (half * (cardWidth + 22) + step * distance * 1.12 / (1 + distance * .12)) : offset * (cardWidth + 22),
    y: Math.min(distance, 3) * 26,
    z: distance ? -Math.min(distance, 4) * 165 : 0,
    angle: distance ? -side * Math.min(distance * 42, 68) : 0,
    scale: Math.max(.55, 1 - distance * .13),
    opacity: distance <= 2 ? 1 : Math.max(0, 3 - distance),
    light: Math.max(.48, 1 - distance * .18),
  };
}
export const clampDeckIndex = (index, count) => Math.max(0, Math.min(Math.max(0, count - 1), index));
