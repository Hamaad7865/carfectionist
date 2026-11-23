// Legacy snapshot labels kept only for rows written before work_places became
// tenant-configurable. New pickers read public.work_places instead.
export const DEPARTMENTS = [
  { slug: "detailing_studio", label: "Detailing studio" },
  { slug: "car_wash", label: "Car wash" },
  { slug: "technical", label: "Technical jobs" },
  { slug: "garage", label: "Garage" },
] as const;

export type DepartmentSlug = (typeof DEPARTMENTS)[number]["slug"];

export const departmentLabel = (slug?: string | null): string | null =>
  DEPARTMENTS.find((d) => d.slug === slug)?.label ?? (slug || null);
