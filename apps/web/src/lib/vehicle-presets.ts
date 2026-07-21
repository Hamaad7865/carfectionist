// Vehicle presets — quick-pick values so staff don't retype the common ones. Every field
// stays free text; these only seed a datalist (web) / chip row (tablet). Kept in step with
// the tablet's lists in android/.../feature/intake/IntakeViewModel.kt (VEHICLE_* vals).

/** Body type — a detailing shop prices/plans by shape (a 4x4/SUV takes more than a sedan). */
export const VEHICLE_CATEGORIES = [
  "SUV",
  "Sedan",
  "Hatchback",
  "Pickup",
  "4x4",
  "Van",
  "MPV",
  "Coupe",
  "Convertible",
  "Motorcycle",
  "Other",
] as const;

/** Common makes in Mauritius — Japanese/Korean heavy, a few European + Indian. */
export const VEHICLE_MAKES = [
  "Toyota",
  "Nissan",
  "Honda",
  "Hyundai",
  "Kia",
  "Suzuki",
  "Mitsubishi",
  "Mazda",
  "BMW",
  "Mercedes-Benz",
  "Audi",
  "Volkswagen",
  "Ford",
  "Peugeot",
  "Renault",
  "Land Rover",
  "Jeep",
  "Isuzu",
  "Mahindra",
  "Volvo",
  "Lexus",
] as const;

export const VEHICLE_COLORS = [
  "Black",
  "White",
  "Silver",
  "Grey",
  "Blue",
  "Red",
  "Green",
  "Beige",
  "Gold",
  "Brown",
  "Maroon",
  "Orange",
  "Yellow",
] as const;
