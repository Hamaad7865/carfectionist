package mu.carfection.pos.feature.intake

// Vehicle presets — quick-pick chips so staff don't retype the common values. Every field
// stays free text; these only seed the chip rows. Kept in step with the web's lists in
// apps/web/src/lib/vehicle-presets.ts.

/** Body type — a detailing shop prices/plans by shape (a 4x4/SUV takes more than a sedan). */
val VEHICLE_CATEGORIES = listOf(
    "SUV", "Sedan", "Hatchback", "Pickup", "4x4", "Van", "MPV", "Coupe", "Convertible", "Motorcycle", "Other",
)

/** Common makes in Mauritius — Japanese/Korean heavy, a few European + Indian. */
val VEHICLE_MAKES = listOf(
    "Toyota", "Nissan", "Honda", "Hyundai", "Kia", "Suzuki", "Mitsubishi", "Mazda",
    "BMW", "Mercedes-Benz", "Audi", "Volkswagen", "Ford", "Peugeot", "Renault",
    "Land Rover", "Jeep", "Isuzu", "Mahindra", "Volvo", "Lexus",
)

val VEHICLE_COLORS = listOf(
    "Black", "White", "Silver", "Grey", "Blue", "Red", "Green", "Beige", "Gold", "Brown", "Maroon", "Orange", "Yellow",
)
