// Pure profile validation. Relocated verbatim from v1 src/main/domain.
//
// Validates a (possibly partial) candidate profile in two dimensions: the
// confirmation gate (mandatory fields) and field ranges. Pure and side-effect
// free; never mutates its argument.

import type { Profile } from '../types'
import { SENIORITY_LEVELS, COMPANY_TYPES } from '../types'

/** The mandatory fields tracked by the confirmation gate. */
export type MandatoryField = 'roleCategories' | 'seniority' | 'companyType'

/** A single field-level range/length violation. */
export interface FieldError {
  field: 'name' | 'targetRole' | 'experienceYears' | 'roleCategories' | 'skills'
  message: string
}

/** The result of validating a profile. */
export interface ProfileValidation {
  valid: boolean
  missingMandatory: MandatoryField[]
  fieldErrors: FieldError[]
}

const NAME_MAX_LENGTH = 100
const TARGET_ROLE_MAX_LENGTH = 100
const EXPERIENCE_YEARS_MIN = 0
const EXPERIENCE_YEARS_MAX = 60
const ROLE_CATEGORIES_MAX = 10
const SKILLS_MIN = 1
const SKILLS_MAX = 50

/**
 * Validate a candidate profile's confirmation gate and field ranges. (Pure.)
 * `valid` is true iff both `missingMandatory` and `fieldErrors` are empty.
 *
 * @param p A possibly-partial candidate profile to validate.
 * @returns The validation result; never mutates `p`.
 */
export function validateProfile(p: Partial<Profile>): ProfileValidation {
  const missingMandatory: MandatoryField[] = []
  const fieldErrors: FieldError[] = []

  const hasRoles = Array.isArray(p.roleCategories) && p.roleCategories.length >= 1
  if (!hasRoles) {
    missingMandatory.push('roleCategories')
  }

  if (p.seniority === undefined || !SENIORITY_LEVELS.includes(p.seniority)) {
    missingMandatory.push('seniority')
  }

  if (p.companyType === undefined || !COMPANY_TYPES.includes(p.companyType)) {
    missingMandatory.push('companyType')
  }

  if (p.name !== undefined && p.name.length > NAME_MAX_LENGTH) {
    fieldErrors.push({
      field: 'name',
      message: `Name must be at most ${NAME_MAX_LENGTH} characters.`,
    })
  }

  if (p.targetRole !== undefined && p.targetRole.length > TARGET_ROLE_MAX_LENGTH) {
    fieldErrors.push({
      field: 'targetRole',
      message: `Target role must be at most ${TARGET_ROLE_MAX_LENGTH} characters.`,
    })
  }

  if (
    p.experienceYears !== undefined &&
    (p.experienceYears < EXPERIENCE_YEARS_MIN || p.experienceYears > EXPERIENCE_YEARS_MAX)
  ) {
    fieldErrors.push({
      field: 'experienceYears',
      message: `Experience years must be between ${EXPERIENCE_YEARS_MIN} and ${EXPERIENCE_YEARS_MAX}.`,
    })
  }

  if (Array.isArray(p.roleCategories) && p.roleCategories.length > ROLE_CATEGORIES_MAX) {
    fieldErrors.push({
      field: 'roleCategories',
      message: `Select at most ${ROLE_CATEGORIES_MAX} role categories.`,
    })
  }

  if (hasRoles) {
    const skillCount = Array.isArray(p.skills) ? p.skills.length : 0
    if (skillCount < SKILLS_MIN || skillCount > SKILLS_MAX) {
      fieldErrors.push({
        field: 'skills',
        message: `Select between ${SKILLS_MIN} and ${SKILLS_MAX} skills when roles are selected.`,
      })
    }
  }

  return {
    valid: missingMandatory.length === 0 && fieldErrors.length === 0,
    missingMandatory,
    fieldErrors,
  }
}
