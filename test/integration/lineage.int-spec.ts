import { Test } from '@nestjs/testing';
import { LineageModule } from '../../src/modules/lineage/lineage.module';
import { LineageService } from '../../src/modules/lineage/lineage.service';
import { ConfigModule } from '../../src/shared/config/config.module';
import { DbModule } from '../../src/shared/db/db.module';

describe('LineageService against Postgres', () => {
  let lineage: LineageService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DbModule, LineageModule],
    }).compile();
    await moduleRef.init();
    lineage = moduleRef.get(LineageService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
  });

  // Found by the 100,000-row load test: the match stage looked up every loaded row of a block,
  // and one bind parameter per id stops at 32,767.
  it('looks up the persons behind more raw rows than Postgres allows bind parameters', async () => {
    const ids = Array.from({ length: 40_000 }, (_, i) => BigInt(i + 1));
    await expect(lineage.personsForRawRows(ids)).resolves.toBeInstanceOf(Map);
  });
});
