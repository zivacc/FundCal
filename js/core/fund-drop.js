/** The drawn basket circle and hit test use the same diameter. */
export const BASKET_DROP_DIAMETER = 260;
export function insideDropCircle(x, y, box) {
  return Math.hypot(x - box.left - box.width / 2, y - box.top - box.height / 2) <= box.width / 2;
}
export function detailDropCode(mode, items) {
  const code = /^fund:(\d{6})$/.exec(mode || '')?.[1];
  return code && items.some(item => item.code === code) ? code : null;
}
