import React from 'react';
import {
  type LucideIcon, Home, Wallet, CreditCard, Banknote, Send, ArrowLeftRight, Receipt, FileText, Upload, Download, User, Users, Settings, Bell, Shield, Lock, LogOut,
  Phone, Mail, MapPin, Calendar, Clock, Briefcase, Building2, Car, Heart, Gift, PiggyBank, BarChart3, TrendingUp, CircleHelp, MessageSquare, Search, Star, Check,
  Plus, Pencil, List, Folder, LayoutDashboard, Globe, IdCard, Landmark, Percent, ShoppingBag, Plane, GraduationCap, Circle,
} from 'lucide-react';

export const iconMap: Record<string, LucideIcon> = {
  home: Home, wallet: Wallet, 'credit-card': CreditCard, banknote: Banknote, send: Send, transfer: ArrowLeftRight, receipt: Receipt, 'file-text': FileText, upload: Upload,
  download: Download, user: User, users: Users, settings: Settings, bell: Bell, shield: Shield, lock: Lock, 'log-out': LogOut, phone: Phone, mail: Mail, 'map-pin': MapPin,
  calendar: Calendar, clock: Clock, briefcase: Briefcase, building: Building2, car: Car, heart: Heart, gift: Gift, 'piggy-bank': PiggyBank, chart: BarChart3,
  'trending-up': TrendingUp, help: CircleHelp, message: MessageSquare, search: Search, star: Star, check: Check, plus: Plus, edit: Pencil, list: List, folder: Folder,
  dashboard: LayoutDashboard, 'layout-dashboard': LayoutDashboard, globe: Globe, 'id-card': IdCard, landmark: Landmark, percent: Percent, 'shopping-bag': ShoppingBag,
  plane: Plane, 'graduation-cap': GraduationCap, circle: Circle, 'bar-chart': BarChart3,
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const C = iconMap[name] ?? Circle;
  return <C size={size} aria-hidden="true" strokeWidth={1.9} />;
}
