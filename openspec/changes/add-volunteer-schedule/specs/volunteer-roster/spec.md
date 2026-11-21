## ADDED Requirements

### Requirement: The Edit drawer records a volunteer's usual days
The volunteer drawer SHALL have "Usual days" after Works: seven toggles, Mon to Sun, none ticked by default. `vitally_save_volunteer` SHALL accept `usualDays`, a list of weekdays from 1 (Monday) to 7 (Sunday). It SHALL store them sorted. It SHALL refuse with `VALIDATION` a value outside 1–7, a repeated day, or a value that is not a list. When `usualDays` is left out, the stored days SHALL be kept, so a caller that doesn't know the field never clears it. Usual days SHALL be readable only as the profile is: by workspace admins, and by the volunteer through My profile (capability `volunteer-schedule`).

#### Scenario: Recording usual days
- **WHEN** an admin ticks Tue and Sat for a volunteer and saves
- **THEN** the volunteer's usual days are Tuesday and Saturday, the drawer shows them ticked when reopened, and the volunteer's My profile shows the same

#### Scenario: A save without the field
- **WHEN** a volunteer's usual days are Tuesday and Saturday, and `vitally_save_volunteer` is called without `usualDays` to change their phone
- **THEN** their usual days are still Tuesday and Saturday

#### Scenario: A repeated day
- **WHEN** `vitally_save_volunteer` is called with `usualDays` [6, 6]
- **THEN** it is refused with `VALIDATION`, and nothing is written
