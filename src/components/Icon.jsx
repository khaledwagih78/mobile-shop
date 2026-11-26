import * as LucideIcons from'lucide-react';

export function Icon({ name, size = 18, strokeWidth = 2, className ='', style = {}, ...props }) {
  if (!name) return null;
  const Component = LucideIcons[name];
  if (!Component) {
    return null;
  }
  return <Component size={size} strokeWidth={strokeWidth} className={className} style={{ display:'inline-block', verticalAlign:'middle', flexShrink: 0, ...style }} {...props} />;
}

export default Icon;
