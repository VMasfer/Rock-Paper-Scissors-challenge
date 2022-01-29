//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

interface IRockPaperScissors {
  enum Hand {
    IDLE,
    ROCK,
    PAPER,
    SCISSORS
  }
  enum Status {
    CREATED,
    STARTED,
    PLAYER1,
    PLAYER2,
    TIE
  }
  struct Game {
    uint256 id;
    address player1;
    address player2;
    uint256 bet;
    uint16 duration;
    uint256 timestamp;
    bytes32 encryptedMove;
    Hand decryptedMove;
    Hand move;
    Status status;
  }

  function createGame(bytes32 _encryptedMove, uint16 _duration) external payable;

  function quitGame(uint256 _gameId) external;

  function playGame(uint256 _gameId, Hand _move) external payable;

  function endGameAsPlayer1(uint256 _gameId, bytes calldata _seed) external;

  function endGameAsPlayer2(uint256 _gameId) external;

  function getGames() external view returns (Game[] memory);

  function getAvailableGames() external view returns (Game[] memory);

  function getAvailableGamesByPlayer(address _player) external view returns (Game[] memory);

  function getAvailablePlayers() external view returns (address[] memory);

  function getActiveGames() external view returns (Game[] memory);

  function getActiveGamesByPlayer(address _player) external view returns (Game[] memory);

  function getActivePlayers() external view returns (address[] memory);

  function getEtherBalance() external view returns (uint256);
}
