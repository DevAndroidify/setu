import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Household, Person } from '@prisma/client';
import { AuditService, GLOBAL_STREAM } from '../audit';
import type { AuthUser, Role } from '../auth';
import { adToBs } from '../transforms';
import { maskCitizenshipNo } from './mask';
import { TargetRepository } from './target.repository';

/** Roles that may see a full citizenship number, and only with a logged reason. */
const MAY_UNMASK: Role[] = ['reviewer', 'auditor'];

const isoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** The API view of a person. Dates are stored in AD; BS is added here, at the edge, on request. */
function view(
  p: Person & { household: Household | null },
  calendar: 'ad' | 'bs',
  unmasked: boolean,
) {
  const dobAd = isoDate(p.dobAd);
  const dobBs = calendar === 'bs' && dobAd ? adToBs(dobAd) : null;
  return {
    id: p.id,
    name_ne: p.nameNe,
    name_en: p.nameEn,
    gender: p.gender,
    dob_ad: dobAd,
    ...(calendar === 'bs' ? { dob_bs: dobBs?.ok ? dobBs.value : null } : {}),
    citizenship_no: unmasked ? p.citizenshipNo : maskCitizenshipNo(p.citizenshipNo),
    citizenship_no_masked: !unmasked && p.citizenshipNo !== null,
    father_name_ne: p.fatherNameNe,
    household: p.household
      ? {
          id: p.household.id,
          local_unit_code: p.household.localUnitCode,
          ward_no: p.household.wardNo,
          tole: p.household.tole,
          is_head: p.household.headPersonId === p.id,
        }
      : null,
    created_by_run: p.createdByRun,
  };
}

@Injectable()
export class PersonsService {
  constructor(
    private readonly repo: TargetRepository,
    private readonly audit: AuditService,
  ) {}

  async search(
    filter: { q?: string; localUnit?: string },
    limit: number,
    cursor: string | undefined,
    calendar: 'ad' | 'bs',
  ) {
    const persons = await this.repo.searchPersons(filter, limit, cursor);
    const data = persons.map((p) => view(p, calendar, false));
    const last = data[data.length - 1];
    return { data, nextCursor: data.length === limit && last ? last.id : null };
  }

  /** One person. Unmasking needs an allowed role and a reason, and is written to the audit log. */
  async get(id: string, calendar: 'ad' | 'bs', unmask?: { reason: string; user: AuthUser }) {
    if (unmask && !MAY_UNMASK.includes(unmask.user.role)) {
      throw new ForbiddenException('Your role cannot see unmasked citizenship numbers');
    }
    const person = await this.repo.findPerson(id);
    if (!person) throw new NotFoundException('Person not found');
    if (unmask) {
      await this.audit.append({
        stream: GLOBAL_STREAM,
        actorId: unmask.user.id,
        action: 'person.unmasked',
        entity: 'person',
        entityId: id,
        payload: { field: 'citizenship_no' },
        reason: unmask.reason,
      });
    }
    return view(person, calendar, !!unmask);
  }
}
