import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { ToBoolean } from './to-boolean';

class Query {
  @ToBoolean()
  flag?: unknown;
}

const parse = (flag: unknown) => plainToInstance(Query, { flag }).flag;

describe('ToBoolean', () => {
  it.each([
    ['true', true],
    [true, true],
    ['false', false],
    [false, false],
  ])('%p → %p', (input, expected) => {
    expect(parse(input)).toBe(expected);
  });

  // Không dùng Boolean(value): Boolean('false') === true. Giá trị lạ giữ nguyên để @IsBoolean báo 400
  it.each(['TRUE', '1', 'yes', ''])('giữ nguyên giá trị lạ %p', (input) => {
    expect(parse(input)).toBe(input);
  });
});
