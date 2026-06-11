# ZI존정산

엑셀 정산표의 계산 방식을 모바일 중심 웹 화면으로 옮긴 TypeScript + Supabase 앱입니다.

## 실행

```bash
npm install
npm run dev
```

Supabase 연결 전에는 브라우저 로컬 저장 모드로 실행됩니다. 공동 저장을 사용하려면
`supabase/schema.sql`을 Supabase SQL Editor에서 실행하고 `.env.example`의 두 환경변수를
로컬 `.env`와 Vercel 프로젝트 환경변수에 등록합니다.

## 기능

- 첫 화면에서 새 정산 시작 또는 참여 키 입력
- 여러 정산 생성, 최근 목록 관리, 생성한 기기에서만 삭제
- 로그인 없는 참여 키 방식의 Supabase 공용 저장
- 비용별 결제자, 금액, 분담 참여자 편집
- 기존 송금 내역 반영
- 최종 송금 경로 자동 계산
- 참여자 이름과 정산 이름 편집
- 참여자, 비용, 송금 내역 추가 및 삭제
- 브라우저 자동 저장
- JSON 백업 및 복원
