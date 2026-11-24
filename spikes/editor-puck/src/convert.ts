// v2 node tree <-> Puck data. Lossless round trip is an exit criterion.
export const toPuck = (n: any): any => {
  const { type, children, ...rest } = n;
  return { type, props: { ...rest, ...(children ? { children: children.map(toPuck) } : {}) } };
};
export const fromPuck = (c: any): any => {
  const { children, ...rest } = c.props;
  return { type: c.type, ...rest, ...(Array.isArray(children) ? { children: children.map(fromPuck) } : {}) };
};
export const screenToData = (s: any) => ({ root: { props: { title: s.title } }, content: s.children.map(toPuck) });
export const dataToScreen = (s: any, d: any) => ({ ...s, title: d.root.props?.title ?? s.title, children: d.content.map(fromPuck) });
