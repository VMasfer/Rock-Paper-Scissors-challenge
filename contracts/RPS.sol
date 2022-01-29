import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import './IRPS.sol';

//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

contract RPS is IRPS, ERC20, Ownable {
  address public rockPaperScissors;

  event RockPaperScissorsUpdated(address _oldRockPaperScissors, address _newRockPaperScissors);
  event RPSMinted(address indexed _minter, uint256 _amount);
  event RPSBurned(address indexed _burner, uint256 _amount);

  constructor(address _rockPaperScissors) ERC20('RockPaperScissors Token', 'RPS') {
    rockPaperScissors = _rockPaperScissors;
  }

  function updateRockPaperScissorsAddress(address _rockPaperScissors) external onlyOwner {
    emit RockPaperScissorsUpdated(rockPaperScissors, _rockPaperScissors);
    rockPaperScissors = _rockPaperScissors;
  }

  function mint(address _to, uint256 _amount) external override {
    //solhint-disable-next-line
    require(msg.sender == rockPaperScissors, 'Only the RockPaperScissors contract can call this function');
    _mint(_to, _amount);
    emit RPSMinted(_to, _amount);
  }

  function burn(address _from, uint256 _amount) external override {
    //solhint-disable-next-line
    require(msg.sender == rockPaperScissors, 'Only the RockPaperScissors contract can call this function');
    _burn(_from, _amount);
    emit RPSBurned(_from, _amount);
  }

  function decimals() public pure override returns (uint8) {
    return 0;
  }
}
