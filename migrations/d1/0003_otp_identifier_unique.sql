-- ponytail: Better Auth #10437/#11105 and fix PR #10443 assume one OTP row.
-- Drop this workaround once the pinned upstream schema/restore fix supplies that guarantee.
-- Only sign-in OTPs are exposed; preserve other verification namespaces unchanged.
DELETE FROM verification
WHERE rowid IN (
  SELECT rowid FROM (
    SELECT rowid, ROW_NUMBER() OVER (
      PARTITION BY identifier ORDER BY createdAt DESC, rowid DESC
    ) AS position
    FROM verification
    WHERE identifier GLOB 'sign-in-otp-*'
  ) WHERE position > 1
);
CREATE UNIQUE INDEX verification_sign_in_otp_identifier_unique
ON verification(identifier)
WHERE identifier GLOB 'sign-in-otp-*';
