import '@openzeppelin/contracts/access/Ownable.sol';
import './IRockPaperScissors.sol';
import './IRPS.sol';

//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

contract RockPaperScissors is IRockPaperScissors, Ownable {
  Game[] public games;
  mapping(address => uint256) public playerToId;
  mapping(uint256 => uint256) private _gameIdToIndex;
  uint256 public gamesCreated;
  uint256 public totalPlayerIds;

  event GameCreated(address indexed _creator, Game indexed _game);
  event GameStarted(address indexed _starter, Game indexed _game);
  event GameEnded(address indexed _ender, Game indexed _game);
  event GameDeleted(address indexed _deleter, Game indexed _game);
  event Received(address indexed _from, uint256 _value);

  modifier checkGame(uint256 _gameId, uint256 _path) {
    Game memory gameM = games[_gameIdToIndex[_gameId]];
    require(_gameId < gamesCreated, 'Game does not exist');
    require(gameM.id == _gameId, 'An unexpected error occurred');
    if (_path == 0) {
      require(gameM.status == Status.CREATED, 'Game has already started');
    } else if (_path == 1) {
      require(gameM.player1 == msg.sender, 'Player 1 is not you');
      if (gameM.status != Status.STARTED) {
        if (gameM.status == Status.CREATED) {
          revert('Game has not started yet');
        } else {
          revert('Game cannot be ended by Player 1');
        }
      }
    } else if (_path == 2) {
      require(gameM.player2 == msg.sender, 'Player 2 is not you');
    } else {
      require(gameM.player1 == msg.sender, 'Player 1 is not you');
      require(gameM.status == Status.CREATED, 'Game has already started');
    }
    _;
  }

  receive() external payable {
    if (msg.value > 0) {
      emit Received(msg.sender, msg.value);
    }
  }

  fallback() external payable {
    revert('Wrong call to contract');
  }

  function createGame(bytes32 _encryptedMove, uint16 _duration) external payable override {
    require(msg.value <= (2**256 - 2) / 2, 'The bet is too big');
    Game memory newGame;
    newGame.id = gamesCreated++;
    newGame.player1 = msg.sender;
    newGame.bet = msg.value;
    newGame.duration = _duration;
    newGame.encryptedMove = _encryptedMove;
    _gameIdToIndex[newGame.id] = games.length;
    games.push(newGame);
    emit GameCreated(msg.sender, newGame);
    if (playerToId[msg.sender] == 0) {
      playerToId[msg.sender] = ++totalPlayerIds;
    }
  }

  function quitGame(uint256 _gameId) external override checkGame(_gameId, 3) {
    _deleteGame(_gameId);
  }

  function playGame(uint256 _gameId, Hand _move) external payable override checkGame(_gameId, 0) {
    Game storage game = games[_gameIdToIndex[_gameId]];
    require(game.bet == msg.value, 'Wrong ether sent');
    require(_move != Hand.IDLE, 'Invalid move');
    game.player2 = msg.sender;
    game.timestamp = block.timestamp;
    game.move = _move;
    game.status = Status.STARTED;
    emit GameStarted(msg.sender, game);
    if (playerToId[msg.sender] == 0) {
      playerToId[msg.sender] = ++totalPlayerIds;
    }
  }

  function endGameAsPlayer1(uint256 _gameId, bytes calldata _seed) external override checkGame(_gameId, 1) {
    _decryptMove(_gameId, _seed);
    Game storage game = games[_gameIdToIndex[_gameId]];
    Game memory gameM = games[_gameIdToIndex[_gameId]];
    if (gameM.decryptedMove == gameM.move) {
      game.status = Status.TIE;
      //solhint-disable-next-line
      (bool sent, ) = msg.sender.call{value: gameM.bet}('');
      require(sent, 'Failed to send the bet back');
      emit GameEnded(msg.sender, game);
    } else if ((uint8(gameM.decryptedMove) + 3 - uint8(gameM.move)) % 3 == 1) {
      game.status = Status.PLAYER1;
      //solhint-disable-next-line
      (bool sent, ) = msg.sender.call{value: gameM.bet * 2}('');
      require(sent, 'Failed to send the reward');
      emit GameEnded(msg.sender, game);
      _deleteGame(_gameId);
    } else {
      game.status = Status.PLAYER2;
      emit GameEnded(msg.sender, game);
    }
  }

  function endGameAsPlayer2(uint256 _gameId) external override checkGame(_gameId, 2) {
    Game storage game = games[_gameIdToIndex[_gameId]];
    Game memory gameM = games[_gameIdToIndex[_gameId]];
    if (gameM.status == Status.TIE) {
      //solhint-disable-next-line
      (bool sent, ) = msg.sender.call{value: gameM.bet}('');
      require(sent, 'Failed to send the bet back');
      _deleteGame(_gameId);
    } else if (gameM.status == Status.STARTED) {
      //solhint-disable-next-line
      require(block.timestamp >= gameM.timestamp + gameM.duration, 'Player 1 still has time to reveal his move');
      game.status = Status.PLAYER2;
      //solhint-disable-next-line
      (bool sent, ) = msg.sender.call{value: gameM.bet * 2}('');
      require(sent, 'Failed to send the reward');
      emit GameEnded(msg.sender, game);
      _deleteGame(_gameId);
    } else {
      //solhint-disable-next-line
      (bool sent, ) = msg.sender.call{value: gameM.bet * 2}('');
      require(sent, 'Failed to send the reward');
      _deleteGame(_gameId);
    }
  }

  function transferERC20Token(address _tokenContractAddress, uint256 _amount) external onlyOwner {
    IERC20 tokenContract = IERC20(_tokenContractAddress);
    tokenContract.transfer(msg.sender, _amount);
  }

  function withdrawEtherBalance(uint256 _amount) external onlyOwner {
    require(address(this).balance >= _amount, 'Insufficient ether in balance');
    //solhint-disable-next-line
    (bool sent, ) = msg.sender.call{value: _amount}('');
    require(sent, 'Failed to send ether');
  }

  function getEtherBalance() external view returns (uint256) {
    return address(this).balance;
  }

  function getGames() external view override returns (Game[] memory) {
    return games;
  }

  function getAvailableGames() external view override returns (Game[] memory) {
    uint256 availableGamesIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED) {
        availableGamesIndex++;
      }
    }
    Game[] memory availableGames = new Game[](availableGamesIndex);
    delete availableGamesIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED) {
        availableGames[availableGamesIndex] = games[i];
        availableGamesIndex++;
      }
    }
    return availableGames;
  }

  function getAvailableGamesByPlayer(address _player) external view override returns (Game[] memory) {
    uint256 availableGamesByPlayerIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED && games[i].player1 == _player) {
        availableGamesByPlayerIndex++;
      }
    }
    Game[] memory availableGamesByPlayer = new Game[](availableGamesByPlayerIndex);
    delete availableGamesByPlayerIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED && games[i].player1 == _player) {
        availableGamesByPlayer[availableGamesByPlayerIndex] = games[i];
        availableGamesByPlayerIndex++;
      }
    }
    return availableGamesByPlayer;
  }

  function getAvailablePlayers() external view override returns (address[] memory) {
    uint256 preAvailablePlayersIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED) {
        preAvailablePlayersIndex++;
      }
    }
    address[] memory preAvailablePlayers = new address[](preAvailablePlayersIndex);
    delete preAvailablePlayersIndex;
    uint256 availablePlayersIndex;
    uint256 playerCount;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED) {
        preAvailablePlayers[preAvailablePlayersIndex] = games[i].player1;
        preAvailablePlayersIndex++;
        for (uint256 j; j < preAvailablePlayersIndex; j++) {
          if (preAvailablePlayers[j] == games[i].player1) {
            playerCount++;
          }
        }
        if (playerCount == 1) {
          availablePlayersIndex++;
        }
        delete playerCount;
      }
    }
    address[] memory availablePlayers = new address[](availablePlayersIndex);
    delete preAvailablePlayersIndex;
    delete availablePlayersIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED) {
        preAvailablePlayersIndex++;
        for (uint256 j; j < preAvailablePlayersIndex; j++) {
          if (preAvailablePlayers[j] == games[i].player1) {
            playerCount++;
          }
        }
        if (playerCount == 1) {
          availablePlayers[availablePlayersIndex] = games[i].player1;
          availablePlayersIndex++;
        }
        delete playerCount;
      }
    }
    return availablePlayers;
  }

  function _decryptMove(uint256 _gameId, bytes calldata _seed) private {
    Game storage game = games[_gameIdToIndex[_gameId]];
    Game memory gameM = games[_gameIdToIndex[_gameId]];
    if (
      keccak256(abi.encodePacked(Hand.ROCK, _seed)) == gameM.encryptedMove ||
      keccak256(abi.encodePacked(_seed, Hand.ROCK)) == gameM.encryptedMove
    ) {
      game.decryptedMove = Hand.ROCK;
    } else if (
      keccak256(abi.encodePacked(Hand.PAPER, _seed)) == gameM.encryptedMove ||
      keccak256(abi.encodePacked(_seed, Hand.PAPER)) == gameM.encryptedMove
    ) {
      game.decryptedMove = Hand.PAPER;
    } else if (
      keccak256(abi.encodePacked(Hand.SCISSORS, _seed)) == gameM.encryptedMove ||
      keccak256(abi.encodePacked(_seed, Hand.SCISSORS)) == gameM.encryptedMove
    ) {
      game.decryptedMove = Hand.SCISSORS;
    } else {
      revert('Decryption failed');
    }
  }

  function _deleteGame(uint256 _gameId) private {
    Game storage game = games[_gameIdToIndex[_gameId]];
    emit GameDeleted(msg.sender, game);
    game = games[games.length - 1];
    _gameIdToIndex[games[games.length - 1].id] = _gameIdToIndex[_gameId];
    delete _gameIdToIndex[_gameId];
    games.pop();
  }
}
