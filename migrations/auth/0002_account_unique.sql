-- "account" 表 (providerId, accountId) 唯一约束（#55）。
--
-- Better Auth 的 identity 匹配按 (providerId, accountId) 查找账户，但没有唯一
-- 约束时，重试 / 并发回调可以写入重复行，之后 findAccount 会命中多行并产生
-- 账户合并歧义。缺这一约束的直接后果：同一个上游身份可能对应两条 account 记录，
-- 每次 /get-session 随机选择其一，会话"看起来随机换人"。
--
-- 写成幂等形式（先查 pg_constraint），重复执行 / 部分应用过的库都能安全重跑。
-- 注意：如果存量数据已经有重复对，本约束会创建失败并使构建失败——这是有意的
-- fail-fast（需要先人工去重），而不是静默跳过。

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'account_provider_account_unique'
  ) then
    alter table "account"
      add constraint "account_provider_account_unique"
      unique ("providerId", "accountId");
  end if;
end
$$;
