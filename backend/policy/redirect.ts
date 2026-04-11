import type { RestrictionReason } from "@/backend/policy/classifier";

export function redirectResponse(reason: RestrictionReason): string {
  switch (reason) {
    case "whole_source_summary":
      return [
        "전체 내용 요약은 도와줄 수 없습니다.",
        "대신 이런 방식으로 도와줄 수 있어요:",
        "",
        "* 한 장면이나 한 부분 이해하기",
        "* 한 인물이나 문제 상황 설명하기",
        "* 선택한 장면 기준으로 구조 정리하기",
      ].join("\n");
    case "draft_feedback":
      return [
        "문장이나 글 전체를 수정하거나 첨삭해줄 수는 없습니다.",
        "대신 이런 방식으로 도와줄 수 있어요:",
        "",
        "* 글 구조를 짧게 정리하기",
        "* 다음 내용 아이디어 2개 제안하기",
        "* 사용할 표현이나 단어 몇 가지 제시하기",
      ].join("\n");
    case "outside_content":
      return [
        "제공된 자료 밖의 새로운 내용을 대신 만들어줄 수는 없습니다.",
        "대신 이런 방식으로 도와줄 수 있어요:",
        "",
        "* 현재 장면과 맞는 전개 아이디어 2개 제안하기",
        "* 이야기 흐름에 맞는 구조 정리하기",
        "* 장면 분위기에 맞는 표현 찾기",
      ].join("\n");
    case "sentence_generation":
    default:
      return [
        "문장을 직접 써주거나 다음 문단을 대신 작성할 수는 없습니다.",
        "대신 이런 방식으로 도와줄 수 있어요:",
        "",
        "* 다음 내용 아이디어 2개 제안",
        "* 사용할 표현 몇 가지 제시",
        "* 글 구조를 짧게 정리",
      ].join("\n");
  }
}
